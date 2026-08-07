// CLAUDE.PET host - frameless transparent WebView2 window (floating ball)
// Zero user-installed deps: uses built-in .NET Framework (WinForms) + WebView2 runtime.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// COM-visible object exposed to the page as window.chrome.webview.hostObjects.petHost
[ComVisible(true)]
public class PetHostBridge
{
    private readonly MainForm _f;
    public PetHostBridge(MainForm f) { _f = f; }
    public void Move(int dx, int dy) { _f.MoveBy(dx, dy); }
    public void Resize(int w, int h) { _f.ResizeWindow(w, h); }
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

    public const string TITLE = "CLAUDE.PET";
    private const int DEF_W = 150, DEF_H = 170;

    public MainForm()
    {
        _hostCfgPath = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "app", "host.json"));
        _bridge = new PetHostBridge(this);
        LoadHostConfig();

        Text = TITLE;
        FormBorderStyle = FormBorderStyle.None;      // no title bar / min / close
        // Setting TransparencyKey/Opacity enables the layered window automatically.
        BackColor = Color.Magenta;                   // transparency key color
        TransparencyKey = Color.Magenta;             // those pixels become see-through
        TopMost = GetBool("topmost", true);
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        ApplyPosition();

        _web = new WebView2 { Dock = DockStyle.Fill };
        _web.DefaultBackgroundColor = Color.Transparent;   // page transparent areas show through
        Controls.Add(_web);

        Shown += async (s, e) => { try { await InitWebAsync(); } catch (Exception ex) { File.WriteAllText(_hostCfgPath + ".err", ex.ToString()); } };
        FormClosing += (s, e) => SaveHostConfig();
    }

    private bool GetBool(string k, bool d) { return _cfg.ContainsKey(k) ? Convert.ToBoolean(_cfg[k]) : d; }
    private int GetInt(string k, int d) { return _cfg.ContainsKey(k) ? Convert.ToInt32(_cfg[k]) : d; }

    private void ApplyPosition()
    {
        int w = GetInt("winW", DEF_W), h = GetInt("winH", DEF_H);
        Size = new Size(Math.Max(120, w), Math.Max(120, h));
        int x = GetInt("winX", -1), y = GetInt("winY", -1);
        if (x < 0 || y < 0)
        {
            Rectangle sa = Screen.PrimaryScreen.WorkingArea;
            x = sa.Right - Size.Width - 12;
            y = sa.Bottom - Size.Height - 12;
        }
        Location = new Point(x, y);
        double op = _cfg.ContainsKey("opacity") ? Convert.ToDouble(_cfg["opacity"]) : 100;
        Opacity = Math.Max(0.15, Math.Min(1.0, op / 100.0));
    }

    public void MoveBy(int dx, int dy)
    {
        Location = new Point(Location.X + dx, Location.Y + dy);
        SaveHostConfig();
    }
    public void ResizeWindow(int w, int h)
    {
        Size = new Size(Math.Max(120, w), Math.Max(120, h));
        SaveHostConfig();
    }
    public void SetOpacity(int percent)
    {
        Opacity = Math.Max(0.15, Math.Min(1.0, percent / 100.0));
        SaveHostConfig();
    }
    public void SetTopMost(bool top) { TopMost = top; SaveHostConfig(); }
    public void CloseHost() { SaveHostConfig(); Close(); }

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
        _cfg["opacity"] = (int)(Opacity * 100);
        _cfg["topmost"] = TopMost;
        try
        {
            var ser = new JavaScriptSerializer();
            File.WriteAllText(_hostCfgPath, ser.Serialize(_cfg));
        }
        catch { }
    }

    private async Task InitWebAsync()
    {
        string dataDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "webview2data");
        var env = await CoreWebView2Environment.CreateAsync(null, dataDir, null);
        await _web.EnsureCoreWebView2Async(env);
        _web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        _web.CoreWebView2.Settings.IsStatusBarEnabled = false;
        _web.CoreWebView2.AddHostObjectToScript("petHost", _bridge);
        _web.CoreWebView2.Navigate("http://127.0.0.1:9876/");
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
