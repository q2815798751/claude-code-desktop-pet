// CLAUDE.PET host - frameless transparent WebView2 window (floating ball)
// Zero user-installed deps: built-in .NET Framework (WinForms) + WebView2 runtime.
// Transparency uses DWM glass (NOT WS_EX_LAYERED) so WebView2 input keeps working.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[ComVisible(true)]
public class PetHostBridge
{
    private readonly MainForm _f;
    public PetHostBridge(MainForm f) { _f = f; }
    public void Move(int dx, int dy) { _f.MoveBy(dx, dy); }
    public void Resize(int w, int h) { _f.ResizeWindow(w, h); }
    // Used by the panel's bottom-right grip: keeps the window's top-left corner
    // fixed so the corner under the cursor moves with it. Resize() is anchored on
    // the centre, which is right for the ball<->panel toggle but wrong for a drag.
    public void ResizeKeepTopLeft(int w, int h) { _f.ResizeKeepTopLeft(w, h); }
    public void SetOpacity(int percent) { _f.SetOpacity(percent); }
    public void SetTopMost(bool top) { _f.SetTopMost(top); }
    public void Close() { _f.CloseHost(); }
}

public class MainForm : Form
{
    private WebView2 _web;
    private readonly PetHostBridge _bridge;
    private readonly string _hostCfgPath;
    private Dictionary<string, object> _cfg = new Dictionary<string, object>();

    // Dragging fires MoveBy dozens of times a second and each one used to write
    // host.json. Coalesce them: mark dirty, save once the movement has settled.
    private readonly Timer _saveTimer = new Timer();
    private bool _dirty;

    // Where the user actually put the pet — independent of any on-screen clamping.
    private Point _centre;

    public const string TITLE = "CLAUDE.PET";
    private const string HOME_URL = "http://127.0.0.1:9876/";
    private const int DEF_W = 150, DEF_H = 170;
    private const int SAVE_SETTLE_MS = 400;
    // Navigation retry: the exe can be launched a moment before the server is
    // listening. One failed Navigate() used to leave a permanently blank window.
    private int _navFails;

    [DllImport("dwmapi.dll")] public static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS m);
    [StructLayout(LayoutKind.Sequential)] public struct MARGINS { public int left, right, top, bottom; }

    public MainForm()
    {
        _hostCfgPath = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "app", "host.json"));
        _bridge = new PetHostBridge(this);
        LoadHostConfig();

        _saveTimer.Interval = SAVE_SETTLE_MS;
        _saveTimer.Tick += (s, e) => { _saveTimer.Stop(); if (_dirty) { _dirty = false; SaveHostConfig(); } };

        Text = TITLE;
        FormBorderStyle = FormBorderStyle.None;      // no title bar / min / close
        BackColor = Color.Black;
        TopMost = GetBool("topmost", true);
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        ApplyPosition();
        RememberCentre();

        _web = new WebView2 { Dock = DockStyle.Fill };
        _web.DefaultBackgroundColor = Color.Transparent;   // page transparent areas show through (DWM glass)
        Controls.Add(_web);

        Shown += async (s, e) => { try { await InitWebAsync(); } catch (Exception ex) { File.WriteAllText(_hostCfgPath + ".err", ex.ToString()); } };
        FormClosing += (s, e) => { _saveTimer.Stop(); SaveHostConfig(); SignalServerExit(); };
    }

    private bool GetBool(string k, bool d) { return _cfg.ContainsKey(k) ? Convert.ToBoolean(_cfg[k]) : d; }
    private int GetInt(string k, int d) { return _cfg.ContainsKey(k) ? Convert.ToInt32(_cfg[k]) : d; }

    private void ApplyPosition()
    {
        int w = GetInt("winW", DEF_W), h = GetInt("winH", DEF_H);
        Size = new Size(Math.Max(120, w), Math.Max(120, h));
        Rectangle sa = Screen.PrimaryScreen.WorkingArea;
        int x = GetInt("winX", -1), y = GetInt("winY", -1);
        if (x < 0 || y < 0)
        {
            x = sa.Right - Size.Width - 12;
            y = sa.Bottom - Size.Height - 12;
        }
        // clamp into the working area so a stale / off-screen saved position
        // (e.g. after disconnecting a wider monitor) never leaves the pet invisible
        x = Math.Max(sa.Left, Math.Min(x, sa.Right - Size.Width));
        y = Math.Max(sa.Top, Math.Min(y, sa.Bottom - Size.Height));
        Location = new Point(x, y);
    }

    public void MoveBy(int dx, int dy)
    {
        Location = new Point(Location.X + dx, Location.Y + dy);
        RememberCentre();
        Touch();
    }

    // Grow/shrink around the window CENTRE. Anchored at the top-left, the panel used
    // to unfold down-right from wherever the ball sat, so the pet appeared to jump.
    // The result is re-clamped so a pet parked in a corner cannot push the panel
    // off-screen — which would also put the collapsed ball out of reach.
    //
    // The clamp is a DISPLAY correction only: it moves Location, never _centre. If it
    // fed back into the anchor, opening the panel near a screen edge would shift it
    // inward and collapsing would then drop the ball somewhere the user never put it.
    // With _centre preserved the ball returns to exactly where it was.
    public void ResizeWindow(int w, int h)
    {
        int nw = Math.Max(120, w), nh = Math.Max(120, h);
        Point c = _centre;
        Rectangle sa = Screen.FromPoint(c).WorkingArea;

        Size = new Size(nw, nh);
        int nx = Math.Max(sa.Left, Math.Min(c.X - nw / 2, sa.Right - nw));
        int ny = Math.Max(sa.Top, Math.Min(c.Y - nh / 2, sa.Bottom - nh));
        Location = new Point(nx, ny);
        Touch();
    }

    private void RememberCentre()
    {
        _centre = new Point(Location.X + Size.Width / 2, Location.Y + Size.Height / 2);
    }

    // Drag-resize from the panel's bottom-right grip. Top-left stays put (unlike
    // ResizeWindow, which grows around the centre). Size is clamped to the working
    // area and the location is nudged back on-screen only when the new size would
    // push the window past the right/bottom edge.
    public void ResizeKeepTopLeft(int w, int h)
    {
        Rectangle sa = Screen.FromPoint(_centre).WorkingArea;
        int nw = Math.Max(260, Math.Min(w, sa.Width));
        int nh = Math.Max(300, Math.Min(h, sa.Height));
        Size = new Size(nw, nh);
        int nx = Math.Max(sa.Left, Math.Min(Location.X, sa.Right - nw));
        int ny = Math.Max(sa.Top, Math.Min(Location.Y, sa.Bottom - nh));
        Location = new Point(nx, ny);
        RememberCentre();
        Touch();
    }

    private void Touch()
    {
        _dirty = true;
        _saveTimer.Stop();
        _saveTimer.Start();
    }
    public void SetOpacity(int percent)
    {
        int v = Math.Max(15, Math.Min(100, percent));
        _cfg["opacity"] = v;
        SaveHostConfig();
        ApplyPageOpacity();
    }
    public void SetTopMost(bool top) { TopMost = top; SaveHostConfig(); }
    public void CloseHost() { SaveHostConfig(); Close(); }

    private void ApplyPageOpacity()
    {
        if (_web == null || _web.CoreWebView2 == null) return;
        double op = _cfg.ContainsKey("opacity") ? Convert.ToDouble(_cfg["opacity"]) : 100;
        string js = "document.documentElement.style.opacity = " + (op / 100.0).ToString("0.##", CultureInfo.InvariantCulture) + ";";
        try { _web.CoreWebView2.ExecuteScriptAsync(js); } catch { }
    }

    private void LoadHostConfig()
    {
        try
        {
            if (File.Exists(_hostCfgPath))
            {
                var ser = new JavaScriptSerializer();
                _cfg = ser.Deserialize<Dictionary<string, object>>(File.ReadAllText(_hostCfgPath));
                if (_cfg == null) _cfg = new Dictionary<string, object>();
            }
        }
        catch { _cfg = new Dictionary<string, object>(); }
    }

    public void SaveHostConfig()
    {
        _cfg["winX"] = Location.X; _cfg["winY"] = Location.Y;
        _cfg["winW"] = Size.Width; _cfg["winH"] = Size.Height;
        if (!_cfg.ContainsKey("opacity")) _cfg["opacity"] = 100;
        _cfg["topmost"] = TopMost;
        _dirty = false;
        try
        {
            var ser = new JavaScriptSerializer();
            File.WriteAllText(_hostCfgPath, ser.Serialize(_cfg));
        }
        catch { }
    }

    // Closing the window means the pet is done: stop the node server too, instead
    // of leaving a hidden scanner holding port 9876 until the next launch. The
    // server's /api/exit is idempotent, so this is harmless when it already asked
    // us to close (terminal ended / bubble menu Quit).
    private void SignalServerExit()
    {
        try
        {
            var req = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(HOME_URL + "api/exit");
            req.Method = "POST";
            req.ContentLength = 0;
            req.Timeout = 600;
            req.ReadWriteTimeout = 600;
            using (req.GetResponse()) { }
        }
        catch { /* server already gone, or still starting */ }
    }

    private bool _offlineShown;

    private void NavigateHome()
    {
        _offlineShown = false;
        try { _web.CoreWebView2.Navigate(HOME_URL); } catch { }
    }

    private void ShowOfflinePage()
    {
        _offlineShown = true;
        try
        {
            _web.CoreWebView2.NavigateToString(
                "<!doctype html><html><body style='margin:0;height:100vh;display:flex;" +
                "align-items:center;justify-content:center;background:#04060d;color:#8fa6c4;" +
                "font:12px Consolas,monospace;text-align:center;padding:12px'>" +
                "<div><b style='color:#00f0ff'>CLAUDE.PET</b><br><br>" +
                "cannot reach 127.0.0.1:9876<br><br>" +
                "<span style='color:#5c6b80'>retrying...<br>start it from the Claude Pet shortcut</span>" +
                "</div></body></html>");
        }
        catch { }
    }

    private async Task InitWebAsync()
    {
        // DWM glass frame into the client area -> transparent window WITHOUT WS_EX_LAYERED
        var m = new MARGINS { left = -1, right = -1, top = -1, bottom = -1 };
        DwmExtendFrameIntoClientArea(this.Handle, ref m);

        string dataDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "webview2data");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir, null);
        await _web.EnsureCoreWebView2Async(env);
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _web.CoreWebView2.AddHostObjectToScript("petHost", _bridge);
        _web.CoreWebView2.NavigationCompleted += async (s, e) =>
        {
            if (e.IsSuccess)
            {
                // Our own "server unavailable" page also completes successfully;
                // it must not look like the real page or the retry loop dies.
                if (_offlineShown) return;
                _navFails = 0;
                ApplyPageOpacity();
                return;
            }
            _navFails++;
            if (_navFails >= 6) ShowOfflinePage();
            await Task.Delay(_navFails < 6 ? 1200 : 5000);
            NavigateHome();
        };
        NavigateHome();
    }
}

public static class Program
{
    [STAThread]
    public static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}
