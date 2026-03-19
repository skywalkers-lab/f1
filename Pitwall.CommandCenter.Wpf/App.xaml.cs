using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Pitwall.CommandCenter.Wpf.Buffers;
using Pitwall.CommandCenter.Wpf.Infrastructure;
using Pitwall.CommandCenter.Wpf.Services;
using Pitwall.CommandCenter.Wpf.ViewModels;
using Pitwall.CommandCenter.Wpf.Views;

namespace Pitwall.CommandCenter.Wpf;

public partial class App : Application
{
    private IHost? _host;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        _host = Host.CreateDefaultBuilder()
            .ConfigureServices(services =>
            {
                services.AddSingleton<IUiDispatcher, WpfUiDispatcher>();
                services.AddSingleton<ITelemetryPacketParser, F1TelemetryPacketParser>();
                services.AddSingleton<ITelemetryBuffer, TelemetryWindowBuffer>();
                services.AddSingleton<ITelemetryIngestService, TelemetryIngestService>();
                services.AddSingleton<IUdpTelemetryReceiver, UdpTelemetryReceiver>();
                services.AddSingleton<TelemetryDashboardViewModel>();
                services.AddSingleton<MainWindow>();
            })
            .Build();

        await _host.StartAsync();

        var mainWindow = _host.Services.GetRequiredService<MainWindow>();
        mainWindow.DataContext = _host.Services.GetRequiredService<TelemetryDashboardViewModel>();
        MainWindow = mainWindow;
        mainWindow.Show();
    }

    protected override async void OnExit(ExitEventArgs e)
    {
        if (_host is not null)
        {
            await _host.StopAsync();
            _host.Dispose();
        }

        base.OnExit(e);
    }
}
