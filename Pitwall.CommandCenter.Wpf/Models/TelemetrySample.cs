namespace Pitwall.CommandCenter.Wpf.Models;

public sealed record TelemetrySample(
    double RelativeSeconds,
    double Throttle,
    double Brake,
    double SpeedKph,
    int Gear,
    int Rpm,
    double LapDeltaSeconds
);
