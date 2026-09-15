export const config = {
  port: Number(process.env.PORT ?? 3001),

  timezone:
    process.env.CALENDAR_TIMEZONE ??
    "Europe/Amsterdam",
};