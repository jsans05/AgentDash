import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Unauthorized</h1>
        <p className="mt-2 text-gray-600">You don't have permission to access this resource.</p>
        <Link href="/roster" className="mt-4 inline-block text-blue-600 hover:text-blue-900">
          Go to Roster
        </Link>
      </div>
    </div>
  );
}
