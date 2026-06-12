export const PLATFORM_ADMIN_EMAILS = ['jzey805@gmail.com', 'hyy7010@gmail.com'];

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  return PLATFORM_ADMIN_EMAILS.includes(email?.toLowerCase() ?? '');
}
