declare module 'react-toastify' {
  import { ReactNode, Component } from 'react';

  export type ToastPosition =
    | 'top-right'
    | 'top-center'
    | 'top-left'
    | 'bottom-right'
    | 'bottom-center'
    | 'bottom-left';

  export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'default';

  export interface ToastOptions {
    position?: ToastPosition;
    autoClose?: number | false;
    closeOnClick?: boolean;
    pauseOnHover?: boolean;
    pauseOnFocusLoss?: boolean;
    closeButton?: boolean | ReactNode;
    draggable?: boolean;
    draggablePercent?: number;
    draggableDirection?: 'x' | 'y';
    hideProgressBar?: boolean;
    progress?: number;
    className?: string;
    bodyClassName?: string;
    progressClassName?: string;
    transition?: any;
    theme?: 'light' | 'dark' | 'colored';
  }

  export interface ToastContainerProps extends ToastOptions {
    newestOnTop?: boolean;
    toastClassName?: string;
    containerId?: string;
    limit?: number;
    enableMultiContainer?: boolean;
  }

  export class ToastContainer extends Component<ToastContainerProps> {}

  export interface Toast {
    (message: ReactNode, options?: ToastOptions): number;
    success(message: ReactNode, options?: ToastOptions): number;
    info(message: ReactNode, options?: ToastOptions): number;
    warn(message: ReactNode, options?: ToastOptions): number;
    warning(message: ReactNode, options?: ToastOptions): number;
    error(message: ReactNode, options?: ToastOptions): number;
    dismiss(id?: number): void;
    isActive(id: number): boolean;
    update(id: number, options: ToastOptions): void;
  }

  export const toast: Toast;
  export function Slide(props: any): JSX.Element;
  export function Bounce(props: any): JSX.Element;
  export function Flip(props: any): JSX.Element;
  export function Zoom(props: any): JSX.Element;
} 