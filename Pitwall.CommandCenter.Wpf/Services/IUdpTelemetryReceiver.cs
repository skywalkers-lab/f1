using System.Threading.Channels;
using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Services;

public interface IUdpTelemetryReceiver
{
    ChannelReader<UdpTelemetryDatagram> Reader { get; }
    Task StartAsync(string host, int port, CancellationToken cancellationToken);
    Task StopAsync();
}
