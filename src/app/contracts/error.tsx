'use client';

// Route-level error boundary for /contracts. Without this, any render
// error in the contracts page surfaces as Next's generic
// "Application error: a client-side exception has occurred" with no way
// back. This shows the failure and a retry instead.
export default function ContractsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white shadow-lg rounded-lg p-8 max-w-lg w-full text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Contract source could not be displayed
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          Something went wrong while loading this page. Try again — if it
          keeps happening, the contract source files may not have been
          deployed with the site.
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
