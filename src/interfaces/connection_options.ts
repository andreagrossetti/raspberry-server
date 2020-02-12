export interface ConnectionOptions {
  onError: () => void;
  onSuccess: () => void;
  timeout: number;
}
