using System.Windows.Threading;

namespace Pitwall.CommandCenter.Wpf.Infrastructure;

public sealed class WpfUiDispatcher : IUiDispatcher
{
    private readonly Dispatcher _dispatcher = Dispatcher.CurrentDispatcher;

    public Task InvokeAsync(Action action, CancellationToken cancellationToken = default)
    {
        if (_dispatcher.CheckAccess())
        {
            action();
            return Task.CompletedTask;
        }

        return _dispatcher.InvokeAsync(action, DispatcherPriority.Background, cancellationToken).Task;
    }
}
