export class AppError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function assertFound<T>(value: T | null | undefined, label: string): T {
  if (value == null) {
    throw new AppError(`${label} not found`, 404);
  }
  return value;
}
