export function isAdultDateOfBirth(dateOfBirth: string | null, today = new Date()): boolean {
  if (!dateOfBirth) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (birth.getUTCFullYear() !== year || birth.getUTCMonth() !== month - 1 || birth.getUTCDate() !== day) {
    return false;
  }
  const eighteenth = Date.UTC(year + 18, month - 1, day);
  return eighteenth <= today.getTime();
}
