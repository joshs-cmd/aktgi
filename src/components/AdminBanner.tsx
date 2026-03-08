import { UserRole } from "@/types/auth";

interface AdminBannerProps {
  userRole?: UserRole | null;
}

export const AdminBanner = ({ userRole }: AdminBannerProps) => {
  if (userRole !== "admin") return null;

  return (
    <div className="bg-amber-400 text-gray-900 text-center py-2 text-sm font-semibold">
      You are logged in as an administrator.
    </div>
  );
};
