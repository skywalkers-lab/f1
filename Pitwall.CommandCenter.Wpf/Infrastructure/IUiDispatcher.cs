namespace Pitwall.CommandCenter.Wpf.Infrastructure;

public interface IUiDispatcher
{
    Task InvokeAsync(Action action, CancellationToken cancellationToken = default);
}
