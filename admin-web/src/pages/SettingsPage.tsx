import { useEffect, useState, useCallback } from 'react';
import Layout from "../components/Layout";

type Tab = 'config' | 'rate-limit' | 'webhooks';

export default function SettingsPage() {
  return (
    <Layout adminName="Admin">
      <h1>Settings</h1>
      <p>Settings placeholder - see Plan 2 for 3-tab implementation.</p>
    </Layout>
  );
}
