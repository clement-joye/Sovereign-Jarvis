export interface ClockPort {
  now(): Date;
}

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}
