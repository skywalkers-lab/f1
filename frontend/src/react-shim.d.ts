declare module 'react' {
  export type SetStateAction<S> = S | ((prevState: S) => S)
  export type Dispatch<A> = (value: A) => void

  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>]
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initialState: S): [S, Dispatch<A>]
  export function useRef<T>(initialValue: T): { current: T }
  export function useRef<T>(initialValue: T | null): { current: T | null }
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
  ): T
  export function memo<T>(component: T, propsAreEqual?: (prevProps: any, nextProps: any) => boolean): T
  export function createContext<T>(defaultValue: T): any
  export function useContext<T>(context: any): T
  export function forwardRef<T, P>(render: (props: P, ref: any) => any): any
  export type ReactNode = any
  export type FC<P = {}> = (props: P) => any
  export type ComponentType<P = {}> = any
  export type CSSProperties = Record<string, any>
  export type HTMLAttributes<T> = Record<string, any>
  export type MouseEvent<T = Element> = any
  export type KeyboardEvent<T = Element> = any
  export type ChangeEvent<T = Element> = any
  export const Fragment: any
  export const StrictMode: any
  export function createElement(type: any, props?: any, ...children: any[]): any
}

declare module 'react/jsx-runtime' {
  export const Fragment: any
  export function jsx(type: any, props: any, key?: any): any
  export function jsxs(type: any, props: any, key?: any): any
}

declare module 'react-dom/client' {
  interface Root {
    render(children: any): void
    unmount(): void
  }
  export function createRoot(container: Element | DocumentFragment, options?: any): Root
}

declare namespace JSX {
  interface IntrinsicAttributes {
    key?: any
  }

  interface IntrinsicElements {
    [elemName: string]: any
  }
}
