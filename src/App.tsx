import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppDataProvider, useAppData } from './context/AppDataContext';
import { ChampionStatus } from './lib/enums';
import { ThemeProvider } from './theme/ThemeProvider';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import HomeScreen from './screens/HomeScreen';
import ChampionsScreen from './screens/ChampionsScreen';
import CampaignsScreen from './screens/CampaignsScreen';
import CampaignDetailScreen from './screens/CampaignDetailScreen';
import ActivitiesScreen from './screens/ActivitiesScreen';
import EventsScreen from './screens/EventsScreen';
import LeaderboardScreen from './screens/LeaderboardScreen';
import RequestsScreen from './screens/RequestsScreen';
import CustomizeScreen from './screens/CustomizeScreen';
import SettingsScreen from './screens/SettingsScreen';

function AccessDisabled({ name }: { name: string }) {
  return (
    <div className="loading-screen">
      <div style={{ fontSize: 48 }}>🔒</div>
      <h2>Access disabled</h2>
      <div className="text-muted" style={{ maxWidth: 420, textAlign: 'center' }}>
        {name ? `${name}, your` : 'Your'} AI Champions Hub access has been disabled by a
        program administrator. Please contact your program manager if you believe this is a mistake.
      </div>
    </div>
  );
}

function Shell() {
  const { loading, error, currentChampion, isAdmin } = useAppData();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <div className="text-muted">Loading AI Champions Hub…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen">
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h2>Couldn't load data</h2>
        <div className="text-muted">{error}</div>
      </div>
    );
  }

  // Disabled (Inactive) champions lose app access — admins are never locked out.
  if (currentChampion && currentChampion.crd49_status === ChampionStatus.Inactive && !isAdmin) {
    return <AccessDisabled name={currentChampion.crd49_displayname ?? ''} />;
  }

  return (
    <ThemeProvider>
      <ToastProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomeScreen />} />
            <Route path="/champions" element={<ChampionsScreen />} />
            <Route path="/campaigns" element={<CampaignsScreen />} />
            <Route path="/campaigns/:id" element={<CampaignDetailScreen />} />
            <Route path="/activities" element={<ActivitiesScreen />} />
            <Route path="/events" element={<EventsScreen />} />
            <Route path="/leaderboard" element={<LeaderboardScreen />} />
            <Route path="/requests" element={<RequestsScreen />} />
            <Route path="/customize" element={<CustomizeScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </ToastProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppDataProvider>
        <Shell />
      </AppDataProvider>
    </BrowserRouter>
  );
}
