using System.Collections.ObjectModel;
using System.Windows.Media;
using System.Windows.Threading;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using LiveChartsCore;
using LiveChartsCore.Defaults;
using LiveChartsCore.SkiaSharpView;
using LiveChartsCore.SkiaSharpView.Painting;
using Pitwall.CommandCenter.Wpf.Infrastructure;
using Pitwall.CommandCenter.Wpf.Models;
using Pitwall.CommandCenter.Wpf.Services;
using SkiaSharp;

namespace Pitwall.CommandCenter.Wpf.ViewModels;

public sealed partial class TelemetryDashboardViewModel : ObservableObject
{
    private readonly ITelemetryIngestService _ingest;
    private readonly IUiDispatcher _uiDispatcher;
    private readonly object _pendingLock = new();
    private readonly List<TelemetrySample> _pending = new(4096);
    private readonly DispatcherTimer _uiTimer;

    private readonly ObservableCollection<ObservablePoint> _throttleValues = new();
    private readonly ObservableCollection<ObservablePoint> _brakeValues = new();
    private readonly ObservableCollection<ObservablePoint> _speedValues = new();
    private readonly ObservableCollection<ObservablePoint> _rpmValues = new();
    private readonly ObservableCollection<ObservablePoint> _gearValues = new();
    private readonly ObservableCollection<ObservablePoint> _deltaValues = new();

    private readonly CancellationTokenSource _lifetimeCts = new();

    [ObservableProperty] private string udpHost = "0.0.0.0";
    [ObservableProperty] private string udpPort = "20777";
    [ObservableProperty] private string windowSeconds = "20";
    [ObservableProperty] private string connectionStatus = "Stopped";
    [ObservableProperty] private Brush connectionStatusBrush = Brushes.Gray;
    [ObservableProperty] private bool canStart = true;
    [ObservableProperty] private bool canStop;
    [ObservableProperty] private bool isAutoScrollPaused;

    public ISeries[] ThrottleBrakeSeries { get; }
    public ISeries[] SpeedSeries { get; }
    public ISeries[] GearRpmSeries { get; }
    public ISeries[] DeltaSeries { get; }

    public Axis[] SharedTimeAxis { get; }
    public Axis[] InputAxis { get; }
    public Axis[] SpeedAxis { get; }
    public Axis[] GearRpmAxes { get; }
    public Axis[] DeltaAxis { get; }

    public TelemetryDashboardViewModel(ITelemetryIngestService ingest, IUiDispatcher uiDispatcher)
    {
        _ingest = ingest;
        _uiDispatcher = uiDispatcher;
        _ingest.SampleIngested += HandleSampleIngested;

        ThrottleBrakeSeries =
        [
            new LineSeries<ObservablePoint>
            {
                Name = "Throttle",
                Values = _throttleValues,
                GeometrySize = 0,
                Fill = null,
                Stroke = new SolidColorPaint(new SKColor(44, 249, 142), 2)
            },
            new LineSeries<ObservablePoint>
            {
                Name = "Brake",
                Values = _brakeValues,
                GeometrySize = 0,
                Fill = null,
                Stroke = new SolidColorPaint(new SKColor(255, 73, 73), 2)
            }
        ];

        SpeedSeries =
        [
            new LineSeries<ObservablePoint>
            {
                Name = "Speed KPH",
                Values = _speedValues,
                GeometrySize = 0,
                Fill = null,
                Stroke = new SolidColorPaint(new SKColor(0, 179, 255), 2)
            }
        ];

        GearRpmSeries =
        [
            new LineSeries<ObservablePoint>
            {
                Name = "RPM",
                Values = _rpmValues,
                GeometrySize = 0,
                Fill = null,
                Stroke = new SolidColorPaint(new SKColor(255, 196, 0), 2)
            },
            new LineSeries<ObservablePoint>
            {
                Name = "Gear",
                Values = _gearValues,
                GeometrySize = 0,
                Fill = null,
                Stroke = new SolidColorPaint(new SKColor(158, 110, 255), 2)
            }
        ];

        DeltaSeries =
        [
            new LineSeries<ObservablePoint>
            {
                Name = "Lap Delta(s)",
                Values = _deltaValues,
                GeometrySize = 0,
                Fill = null,
                Stroke = new SolidColorPaint(new SKColor(129, 205, 255), 2)
            }
        ];

        SharedTimeAxis =
        [
            new Axis
            {
                Name = "Time (s)",
                LabelsPaint = new SolidColorPaint(new SKColor(127, 160, 181)),
                SeparatorsPaint = new SolidColorPaint(new SKColor(34, 54, 66, 150), 1)
            }
        ];

        InputAxis =
        [
            new Axis
            {
                Name = "Input %",
                MinLimit = 0,
                MaxLimit = 100,
                LabelsPaint = new SolidColorPaint(new SKColor(127, 160, 181)),
                SeparatorsPaint = new SolidColorPaint(new SKColor(34, 54, 66, 150), 1)
            }
        ];

        SpeedAxis =
        [
            new Axis
            {
                Name = "KPH",
                MinLimit = 0,
                LabelsPaint = new SolidColorPaint(new SKColor(127, 160, 181)),
                SeparatorsPaint = new SolidColorPaint(new SKColor(34, 54, 66, 150), 1)
            }
        ];

        GearRpmAxes =
        [
            new Axis
            {
                Name = "Value",
                MinLimit = -1,
                LabelsPaint = new SolidColorPaint(new SKColor(127, 160, 181)),
                SeparatorsPaint = new SolidColorPaint(new SKColor(34, 54, 66, 150), 1)
            }
        ];

        DeltaAxis =
        [
            new Axis
            {
                Name = "Seconds",
                LabelsPaint = new SolidColorPaint(new SKColor(127, 160, 181)),
                SeparatorsPaint = new SolidColorPaint(new SKColor(34, 54, 66, 150), 1)
            }
        ];

        _uiTimer = new DispatcherTimer(DispatcherPriority.Background)
        {
            Interval = TimeSpan.FromMilliseconds(33)
        };
        _uiTimer.Tick += (_, _) => FlushPendingToUi();
        _uiTimer.Start();
    }

    [RelayCommand]
    private async Task StartAsync()
    {
        if (!int.TryParse(UdpPort, out var port))
        {
            ConnectionStatus = "Invalid Port";
            ConnectionStatusBrush = Brushes.OrangeRed;
            return;
        }

        if (!double.TryParse(WindowSeconds, out var seconds) || seconds <= 2)
        {
            ConnectionStatus = "Invalid Window";
            ConnectionStatusBrush = Brushes.OrangeRed;
            return;
        }

        CanStart = false;
        CanStop = true;
        ConnectionStatus = "Starting...";
        ConnectionStatusBrush = Brushes.Gold;

        await _ingest.StartAsync(UdpHost, port, TimeSpan.FromSeconds(seconds), _lifetimeCts.Token);

        ConnectionStatus = "Receiving";
        ConnectionStatusBrush = Brushes.LawnGreen;
    }

    [RelayCommand]
    private async Task StopAsync()
    {
        CanStop = false;
        ConnectionStatus = "Stopping...";
        ConnectionStatusBrush = Brushes.Gold;

        await _ingest.StopAsync();

        CanStart = true;
        ConnectionStatus = "Stopped";
        ConnectionStatusBrush = Brushes.Gray;
    }

    private void HandleSampleIngested(TelemetrySample sample)
    {
        lock (_pendingLock)
        {
            _pending.Add(sample);

            // Fast-path decimation to protect UI when packet rate spikes above chart refresh.
            if (_pending.Count > 5000)
            {
                _pending.RemoveRange(0, 2500);
            }
        }
    }

    private async void FlushPendingToUi()
    {
        List<TelemetrySample>? batch = null;

        lock (_pendingLock)
        {
            if (_pending.Count > 0)
            {
                batch = new List<TelemetrySample>(_pending);
                _pending.Clear();
            }
        }

        if (batch is null || batch.Count == 0)
        {
            return;
        }

        // Secondary sampling to cap point count added per frame.
        var sampled = DownSample(batch, 600);

        await _uiDispatcher.InvokeAsync(() =>
        {
            foreach (var sample in sampled)
            {
                var x = sample.RelativeSeconds;
                _throttleValues.Add(new ObservablePoint(x, sample.Throttle));
                _brakeValues.Add(new ObservablePoint(x, sample.Brake));
                _speedValues.Add(new ObservablePoint(x, sample.SpeedKph));
                _rpmValues.Add(new ObservablePoint(x, sample.Rpm));
                _gearValues.Add(new ObservablePoint(x, sample.Gear));
                _deltaValues.Add(new ObservablePoint(x, sample.LapDeltaSeconds));
            }

            TrimByWindow(_throttleValues);
            TrimByWindow(_brakeValues);
            TrimByWindow(_speedValues);
            TrimByWindow(_rpmValues);
            TrimByWindow(_gearValues);
            TrimByWindow(_deltaValues);

            if (!IsAutoScrollPaused && _throttleValues.Count > 0)
            {
                var latestX = _throttleValues[^1].X ?? 0;
                if (double.TryParse(WindowSeconds, out var seconds) && seconds > 0)
                {
                    var minX = latestX - seconds;
                    SharedTimeAxis[0].MinLimit = minX;
                    SharedTimeAxis[0].MaxLimit = latestX;
                }
            }
        });
    }

    private List<TelemetrySample> DownSample(List<TelemetrySample> input, int maxPoints)
    {
        if (input.Count <= maxPoints)
        {
            return input;
        }

        var step = (double)input.Count / maxPoints;
        var output = new List<TelemetrySample>(maxPoints);

        for (var i = 0; i < maxPoints; i++)
        {
            var index = (int)Math.Floor(i * step);
            output.Add(input[Math.Clamp(index, 0, input.Count - 1)]);
        }

        return output;
    }

    private void TrimByWindow(ObservableCollection<ObservablePoint> points)
    {
        if (points.Count == 0)
        {
            return;
        }

        if (!double.TryParse(WindowSeconds, out var seconds) || seconds <= 0)
        {
            seconds = 20;
        }

        var latest = points[^1].X ?? 0;
        var minAllowed = latest - seconds;

        while (points.Count > 0 && (points[0].X ?? 0) < minAllowed)
        {
            points.RemoveAt(0);
        }
    }
}
