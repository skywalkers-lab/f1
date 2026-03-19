using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Services;

public interface ITelemetryIngestService
{
    event Action<TelemetrySample>? SampleIngested;

    Task StartAsync(string host, int port, TimeSpan window, CancellationToken cancellationToken);
    Task StopAsync();
}
