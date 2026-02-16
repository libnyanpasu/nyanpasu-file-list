export const parseContentRange = (value: string | null) => {
  if (!value) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(total) ||
    start < 0 ||
    end < start ||
    total <= 0
  ) {
    return null;
  }

  return { start, end, total };
};
