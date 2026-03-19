using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Services;

public interface ITelemetryPacketParser
{
    bool TryParse(byte[] datagram, DateTimeOffset timestamp, out TelemetrySample sample);
}
