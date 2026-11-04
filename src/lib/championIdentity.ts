export function normalizeChampionUserId(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}
