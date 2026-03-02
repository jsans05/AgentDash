"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type User = {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: string;
  created_at: string;
  last_sign_in: string | null;
};

export function UsersClient() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  async function fetchUsers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("Failed to load users");
      const data = await res.json();
      setUsers(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchUsers();
  }, []);

  function showMsg(type: "success" | "error", text: string) {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  }

  if (loading) {
    return (
      <div className="mt-6 text-sm text-gray-500">Loading users...</div>
    );
  }

  if (error) {
    return (
      <div className="mt-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {message && (
        <div
          className={`rounded-md p-4 text-sm ${
            message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => {
            setShowCreateModal(true);
            setEditingUser(null);
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add User
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Email
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Role
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                Last sign-in
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {users.map((user) => (
              <tr key={user.user_id}>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                  {[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {user.email || "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      user.role === "admin"
                        ? "bg-purple-100 text-purple-800"
                        : user.role === "sales"
                        ? "bg-blue-100 text-blue-800"
                        : "bg-green-100 text-green-800"
                    }`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                  {user.last_sign_in
                    ? new Date(user.last_sign_in).toLocaleString()
                    : "Never"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                  <button
                    onClick={() => {
                      setEditingUser(user);
                      setShowCreateModal(false);
                    }}
                    className="text-blue-600 hover:text-blue-900"
                  >
                    Edit
                  </button>
                  <span className="mx-2 text-gray-300">|</span>
                  <button
                    onClick={async () => {
                      if (!confirm(`Delete user ${user.email}? This cannot be undone.`)) return;
                      setSaving(true);
                      const res = await fetch(`/api/admin/users/${user.user_id}`, {
                        method: "DELETE",
                      });
                      const data = await res.json();
                      if (data.success) {
                        showMsg("success", "User deleted.");
                        fetchUsers();
                        router.refresh();
                      } else {
                        showMsg("error", data.error || "Delete failed.");
                      }
                      setSaving(false);
                    }}
                    disabled={saving}
                    className="text-red-600 hover:text-red-900 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showCreateModal || editingUser) && (
        <UserModal
          user={editingUser}
          onClose={() => {
            setShowCreateModal(false);
            setEditingUser(null);
          }}
          onSaved={() => {
            setShowCreateModal(false);
            setEditingUser(null);
            fetchUsers();
            router.refresh();
            showMsg("success", editingUser ? "User updated." : "User created.");
          }}
          onError={(err) => showMsg("error", err)}
        />
      )}
    </div>
  );
}

function UserModal({
  user,
  onClose,
  onSaved,
  onError,
}: {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const isEdit = !!user;
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [first_name, setFirstName] = useState(user?.first_name ?? "");
  const [last_name, setLastName] = useState(user?.last_name ?? "");
  const [role, setRole] = useState(user?.role ?? "agent");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    try {
      if (isEdit) {
        const body: Record<string, string> = {
          email: email.trim(),
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          role,
        };
        if (password.trim()) body.password = password.trim();

        const res = await fetch(`/api/admin/users/${user!.user_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Update failed");
        onSaved();
      } else {
        if (!password.trim()) {
          onError("Password is required for new users.");
          setSaving(false);
          return;
        }
        const res = await fetch("/api/admin/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            password: password.trim(),
            first_name: first_name.trim(),
            last_name: last_name.trim(),
            role,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Create failed");
        onSaved();
      }
    } catch (e: any) {
      onError(e.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-gray-900">
          {isEdit ? "Edit User" : "Add User"}
        </h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">First name</label>
            <input
              type="text"
              value={first_name}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Last name</label>
            <input
              type="text"
              value={last_name}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Password {isEdit && "(leave blank to keep current)"}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "••••••••" : "Required for new user"}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Role</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="agent">Agent</option>
              <option value="sales">Sales</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : isEdit ? "Save" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
