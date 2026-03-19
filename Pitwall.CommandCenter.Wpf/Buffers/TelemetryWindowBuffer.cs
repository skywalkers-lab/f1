using System.Collections.Concurrent;
using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Buffers;

public sealed class TelemetryWindowBuffer : ITelemetryBuffer
{
    private readonly ConcurrentQueue<TelemetrySample> _samples = new();
    private TimeSpan _window = TimeSpan.FromSeconds(20);

    public void SetWindow(TimeSpan window)
    {
        _window = window <= TimeSpan.Zero ? TimeSpan.FromSeconds(20) : window;
    }

    public void Add(TelemetrySample sample)
    {
        _samples.Enqueue(sample);
        Trim(sample.RelativeSeconds);
    }

    public IReadOnlyList<TelemetrySample> Snapshot()
    {
        return _samples.ToArray();
    }

    private void Trim(double latestSeconds)
    {
        var minAllowed = latestSeconds - _window.TotalSeconds;

        while (_samples.TryPeek(out var head) && head.RelativeSeconds < minAllowed)
        {
            _samples.TryDequeue(out _);
        }
    }
}
