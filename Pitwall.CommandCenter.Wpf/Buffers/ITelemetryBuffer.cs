using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Buffers;

public interface ITelemetryBuffer
{
    void SetWindow(TimeSpan window);
    void Add(TelemetrySample sample);
    IReadOnlyList<TelemetrySample> Snapshot();
}
