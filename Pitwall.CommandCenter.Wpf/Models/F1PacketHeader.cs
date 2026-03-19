namespace Pitwall.CommandCenter.Wpf.Models;

public sealed record F1PacketHeader(
    ushort PacketFormat,
    byte GameMajorVersion,
    byte GameMinorVersion,
    byte PacketVersion,
    byte PacketId,
    ulong SessionUid,
    float SessionTime,
    uint FrameIdentifier,
    uint OverallFrameIdentifier,
    byte PlayerCarIndex,
    byte SecondaryPlayerCarIndex
);
