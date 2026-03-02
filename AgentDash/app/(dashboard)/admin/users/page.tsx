import { requireRole } from "@/lib/auth";
import { UsersClient } from "./client";

export default async function AdminUsersPage() {
  await requireRole("admin");

  return (
    <div className="px-4 sm:px-6 lg:px-8">
      <div className="sm:flex sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Manage user accounts, names, emails, passwords, and roles.
      </p>
      <UsersClient />
    </div>
  );
}
