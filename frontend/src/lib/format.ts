const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

export function formatDateTime(value: string) {
  return dateFormatter.format(new Date(value));
}

export function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 ? Math.round(size) : size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (!seconds || seconds <= 0) {
    return "0:00";
  }
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export function formatTimestamp(seconds: number | null | undefined, fractionDigits = 0) {
  const precision = Math.max(0, Math.min(3, Math.floor(fractionDigits)));
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return precision > 0 ? `0:00.${"0".repeat(precision)}` : "0:00";
  }

  const unitFactor = 10 ** precision;
  const totalUnits = Math.round(seconds * unitFactor);
  const totalWholeSeconds = Math.floor(totalUnits / unitFactor);
  const fractionalUnits = totalUnits % unitFactor;

  const hours = Math.floor(totalWholeSeconds / 3600);
  const minutes = Math.floor((totalWholeSeconds % 3600) / 60);
  const wholeSeconds = totalWholeSeconds % 60;

  const secondsText =
    precision > 0
      ? `${wholeSeconds.toString().padStart(2, "0")}.${fractionalUnits.toString().padStart(precision, "0")}`
      : wholeSeconds.toString().padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secondsText}`;
  }
  return `${minutes}:${secondsText}`;
}

export function titleizeSlug(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
