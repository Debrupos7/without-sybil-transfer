'use client';

// Route-level error boundary for /dashboard. Without this, any render
// error (e.g. a malformed contract row) surfaces as Next's generic
// "Application error: a client-side exception has occurred" with no way
// back. This shows the failure and a retry instead.
export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Something went wrong on the Dashboard
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          The page hit an unexpected error. Try again — your networks and
          contracts are stored on the server, so retrying will reload them.
        </p>
        <button
          onClick={() => reset()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
