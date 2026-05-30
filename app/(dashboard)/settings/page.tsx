export const dynamic = "force-dynamic";
import prisma from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsForm } from "@/components/settings/settings-form";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const settings = await prisma.userSettings.findUnique({
    where: { userId: user.id },
  });

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Configure your email sending credentials</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Email Provider</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm
            initialApiKey={settings?.brevoApiKey ?? ""}
            initialDailySendLimit={settings?.dailySendLimit ?? 300}
          />
        </CardContent>
      </Card>
    </div>
  );
}
