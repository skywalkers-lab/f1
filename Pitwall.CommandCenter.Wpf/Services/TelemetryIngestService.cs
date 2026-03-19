using Pitwall.CommandCenter.Wpf.Buffers;
using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Services;

public sealed class TelemetryIngestService : ITelemetryIngestService
{
    private readonly IUdpTelemetryReceiver _receiver;
    private readonly ITelemetryPacketParser _parser;
    private readonly ITelemetryBuffer _buffer;

    private CancellationTokenSource? _cts;
    private Task? _consumeLoop;

    public event Action<TelemetrySample>? SampleIngested;

    public TelemetryIngestService(
        IUdpTelemetryReceiver receiver,
        ITelemetryPacketParser parser,
        ITelemetryBuffer buffer)
    {
        _receiver = receiver;
        _parser = parser;
        _buffer = buffer;
    }

    public async Task StartAsync(string host, int port, TimeSpan window, CancellationToken cancellationToken)
    {
        if (_consumeLoop is not null)
        {
            return;
        }

        _buffer.SetWindow(window);
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        await _receiver.StartAsync(host, port, _cts.Token).ConfigureAwait(false);

        _consumeLoop = Task.Run(async () =>
        {
            await foreach (var datagram in _receiver.Reader.ReadAllAsync(_cts.Token).ConfigureAwait(false))
            {
                if (_parser.TryParse(datagram.Payload, datagram.ReceivedAtUtc, out var sample))
                {
                    _buffer.Add(sample);
                    SampleIngested?.Invoke(sample);
                }
            }
        }, _cts.Token);
    }

    public async Task StopAsync()
    {
        if (_cts is null)
        {
            return;
        }

        _cts.Cancel();

        if (_consumeLoop is not null)
        {
            try
            {
                await _consumeLoop.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
            }
        }

        await _receiver.StopAsync().ConfigureAwait(false);

        _consumeLoop = null;
        _cts.Dispose();
        _cts = null;
    }
}
