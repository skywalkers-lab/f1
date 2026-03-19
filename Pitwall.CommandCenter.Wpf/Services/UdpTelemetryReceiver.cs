using System.Net;
using System.Net.Sockets;
using System.Threading.Channels;
using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Services;

public sealed class UdpTelemetryReceiver : IUdpTelemetryReceiver
{
    private readonly Channel<UdpTelemetryDatagram> _channel =
        Channel.CreateBounded<UdpTelemetryDatagram>(new BoundedChannelOptions(16_384)
        {
            SingleReader = true,
            SingleWriter = true,
            FullMode = BoundedChannelFullMode.DropOldest
        });

    private UdpClient? _udp;
    private CancellationTokenSource? _loopCts;
    private Task? _readLoop;

    public ChannelReader<UdpTelemetryDatagram> Reader => _channel.Reader;

    public Task StartAsync(string host, int port, CancellationToken cancellationToken)
    {
        if (_readLoop is not null)
        {
            return Task.CompletedTask;
        }

        var ip = IPAddress.TryParse(host, out var parsed) ? parsed : IPAddress.Any;
        _udp = new UdpClient(new IPEndPoint(ip, port));
        _loopCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        _readLoop = Task.Run(async () =>
        {
            while (!_loopCts.IsCancellationRequested)
            {
                try
                {
                    var result = await _udp.ReceiveAsync(_loopCts.Token).ConfigureAwait(false);
                    await _channel.Writer.WriteAsync(
                        new UdpTelemetryDatagram(result.Buffer, DateTimeOffset.UtcNow),
                        _loopCts.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch
                {
                    await Task.Delay(10, _loopCts.Token).ConfigureAwait(false);
                }
            }
        }, _loopCts.Token);

        return Task.CompletedTask;
    }

    public async Task StopAsync()
    {
        if (_loopCts is null)
        {
            return;
        }

        _loopCts.Cancel();

        if (_readLoop is not null)
        {
            await _readLoop.ConfigureAwait(false);
        }

        _udp?.Dispose();
        _udp = null;
        _readLoop = null;
        _loopCts.Dispose();
        _loopCts = null;
    }
}
