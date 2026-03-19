namespace Pitwall.CommandCenter.Wpf.Models;

public sealed record UdpTelemetryDatagram(byte[] Payload, DateTimeOffset ReceivedAtUtc);
