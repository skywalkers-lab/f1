using System.Buffers.Binary;
using Pitwall.CommandCenter.Wpf.Models;

namespace Pitwall.CommandCenter.Wpf.Services;

public sealed class F1TelemetryPacketParser : ITelemetryPacketParser
{
    // F1 telemetry datagram layout used by this parser:
    // [header(29 bytes)] [car telemetry packet payload]
    // Offsets below are practical defaults for player-car telemetry packet fields.
    private const int HeaderSize = 29;
    private const int TelemetryPacketId = 6;

    // Player car data starts with packet header + (playerIndex * CarTelemetryDataSize)
    // CarTelemetryData structure size in many Codemasters packet versions: 60 bytes.
    private const int CarTelemetryDataSize = 60;

    // Relative offsets within a player car telemetry block.
    private const int SpeedOffset = 0;      // uint16
    private const int ThrottleOffset = 6;   // float32 [0..1]
    private const int SteerOffset = 10;     // float32 (unused)
    private const int BrakeOffset = 14;     // float32 [0..1]
    private const int ClutchOffset = 18;    // byte (unused)
    private const int GearOffset = 19;      // sbyte
    private const int RpmOffset = 20;       // uint16

    // Lap delta is not part of telemetry packet in some versions;
    // for demo pipeline we derive a pseudo delta from speed trend if real value is absent.
    private double _baselineSpeed = 0.0;
    private bool _baselineInitialized;

    public bool TryParse(byte[] datagram, DateTimeOffset timestamp, out TelemetrySample sample)
    {
        sample = default!;

        if (datagram.Length < HeaderSize + CarTelemetryDataSize)
        {
            return false;
        }

        var header = ParseHeader(datagram);
        if (header is null || header.PacketId != TelemetryPacketId)
        {
            return false;
        }

        var playerIndex = header.PlayerCarIndex;
        var playerOffset = HeaderSize + playerIndex * CarTelemetryDataSize;

        if (datagram.Length < playerOffset + CarTelemetryDataSize)
        {
            return false;
        }

        var speed = BinaryPrimitives.ReadUInt16LittleEndian(datagram.AsSpan(playerOffset + SpeedOffset, 2));
        var throttle = BinaryPrimitives.ReadSingleLittleEndian(datagram.AsSpan(playerOffset + ThrottleOffset, 4));
        var brake = BinaryPrimitives.ReadSingleLittleEndian(datagram.AsSpan(playerOffset + BrakeOffset, 4));
        var gear = (sbyte)datagram[playerOffset + GearOffset];
        var rpm = BinaryPrimitives.ReadUInt16LittleEndian(datagram.AsSpan(playerOffset + RpmOffset, 2));

        if (!_baselineInitialized)
        {
            _baselineSpeed = speed;
            _baselineInitialized = true;
        }

        var speedDelta = speed - _baselineSpeed;
        var lapDelta = speedDelta * -0.0035;

        sample = new TelemetrySample(
            RelativeSeconds: header.SessionTime,
            Throttle: Math.Clamp(throttle * 100.0, 0.0, 100.0),
            Brake: Math.Clamp(brake * 100.0, 0.0, 100.0),
            SpeedKph: speed,
            Gear: gear,
            Rpm: rpm,
            LapDeltaSeconds: lapDelta);

        return true;
    }

    private static F1PacketHeader? ParseHeader(ReadOnlySpan<byte> data)
    {
        if (data.Length < HeaderSize)
        {
            return null;
        }

        var packetFormat = BinaryPrimitives.ReadUInt16LittleEndian(data.Slice(0, 2));
        var major = data[2];
        var minor = data[3];
        var packetVersion = data[5];
        var packetId = data[6];
        var sessionUid = BinaryPrimitives.ReadUInt64LittleEndian(data.Slice(7, 8));
        var sessionTime = BinaryPrimitives.ReadSingleLittleEndian(data.Slice(15, 4));
        var frameIdentifier = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(19, 4));
        var overallFrame = BinaryPrimitives.ReadUInt32LittleEndian(data.Slice(23, 4));
        var playerCar = data[27];
        var secondaryPlayer = data[28];

        return new F1PacketHeader(packetFormat, major, minor, packetVersion, packetId, sessionUid, sessionTime, frameIdentifier, overallFrame, playerCar, secondaryPlayer);
    }
}
