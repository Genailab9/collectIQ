export default function MaintenancePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">CollectIQ is in maintenance</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We are applying a controlled upgrade. Please try again shortly. Operators can still access the API directly if
        your deployment allows it.
      </p>
    </div>
  );
}
