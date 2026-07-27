/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getContext } from '@microsoft/power-apps/app';
import {
  ChampionsSvc, DepartmentsSvc, CampaignsSvc, CampaignDepartmentsSvc, CampaignActivitiesSvc,
  CampaignParticipationsSvc, ActivitiesSvc, ActivityClaimsSvc, ClaimEvidencesSvc, EventsSvc,
  RequestsSvc, ProgramSettingsSvc, AppAdminsSvc,
  type Abs_champions, type Abs_departments, type Abs_campaigns, type Abs_campaigndepartments,
  type Abs_campaignactivities, type Abs_campaignparticipations, type Abs_activities,
  type Abs_activityclaims, type Abs_claimevidences, type Abs_events, type Abs_requests,
  type Abs_programsettingses, type Abs_appadmins,
} from '../data/entities';
import { ChampionRole, ClaimStatus } from '../lib/enums';

export interface CurrentUser {
  fullName: string;
  userPrincipalName: string;
  objectId: string;
}

interface AppDataValue {
  loading: boolean;
  error?: string;

  currentUser: CurrentUser | null;
  currentChampion: Abs_champions | null;
  isProgramManager: boolean;
  isAppAdmin: boolean;
  isAdmin: boolean;

  champions: Abs_champions[];
  departments: Abs_departments[];
  campaigns: Abs_campaigns[];
  campaignDepartments: Abs_campaigndepartments[];
  campaignActivities: Abs_campaignactivities[];
  participations: Abs_campaignparticipations[];
  activities: Abs_activities[];
  claims: Abs_activityclaims[];
  evidence: Abs_claimevidences[];
  events: Abs_events[];
  requests: Abs_requests[];
  settings: Abs_programsettingses | null;
  appAdmins: Abs_appadmins[];

  // Lookup maps
  championById: Map<string, Abs_champions>;
  departmentById: Map<string, Abs_departments>;
  campaignById: Map<string, Abs_campaigns>;
  activityById: Map<string, Abs_activities>;

  /** Points earned (sum of approved-claim activity points) per champion id. */
  pointsByChampion: Map<string, number>;
  pointsFor: (championId?: string) => number;

  reload: () => Promise<void>;
}

const AppDataContext = createContext<AppDataValue | undefined>(undefined);

async function all<T>(p: Promise<{ data: T[] }>): Promise<T[]> {
  const r = await p;
  return r.data || [];
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);

  const [champions, setChampions] = useState<Abs_champions[]>([]);
  const [departments, setDepartments] = useState<Abs_departments[]>([]);
  const [campaigns, setCampaigns] = useState<Abs_campaigns[]>([]);
  const [campaignDepartments, setCampaignDepartments] = useState<Abs_campaigndepartments[]>([]);
  const [campaignActivities, setCampaignActivities] = useState<Abs_campaignactivities[]>([]);
  const [participations, setParticipations] = useState<Abs_campaignparticipations[]>([]);
  const [activities, setActivities] = useState<Abs_activities[]>([]);
  const [claims, setClaims] = useState<Abs_activityclaims[]>([]);
  const [evidence, setEvidence] = useState<Abs_claimevidences[]>([]);
  const [events, setEvents] = useState<Abs_events[]>([]);
  const [requests, setRequests] = useState<Abs_requests[]>([]);
  const [settings, setSettings] = useState<Abs_programsettingses | null>(null);
  const [appAdmins, setAppAdmins] = useState<Abs_appadmins[]>([]);

  const reload = useCallback(async () => {
    const [
      champ, dept, camp, campDept, campAct, part, act, clm, evid, evt, req, sett, admins,
    ] = await Promise.all([
      all(ChampionsSvc.getAll({ top: 5000 })),
      all(DepartmentsSvc.getAll({ top: 5000 })),
      all(CampaignsSvc.getAll({ top: 5000 })),
      all(CampaignDepartmentsSvc.getAll({ top: 5000 })),
      all(CampaignActivitiesSvc.getAll({ top: 5000 })),
      all(CampaignParticipationsSvc.getAll({ top: 5000 })),
      all(ActivitiesSvc.getAll({ top: 5000 })),
      all(ActivityClaimsSvc.getAll({ top: 5000 })),
      all(ClaimEvidencesSvc.getAll({ top: 5000 })),
      all(EventsSvc.getAll({ top: 5000 })),
      all(RequestsSvc.getAll({ top: 5000 })),
      all(ProgramSettingsSvc.getAll({ top: 5 })),
      all(AppAdminsSvc.getAll({ top: 5000 })),
    ]);
    setChampions(champ);
    setDepartments(dept);
    setCampaigns(camp);
    setCampaignDepartments(campDept);
    setCampaignActivities(campAct);
    setParticipations(part);
    setActivities(act);
    setClaims(clm);
    setEvidence(evid);
    setEvents(evt);
    setRequests(req);
    setSettings(sett[0] ?? null);
    setAppAdmins(admins);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(undefined);
      try {
        let user: CurrentUser | null = null;
        try {
          const ctx = await getContext();
          user = {
            fullName: ctx.user.fullName ?? '',
            userPrincipalName: ctx.user.userPrincipalName ?? '',
            objectId: ctx.user.objectId ?? '',
          };
        } catch {
          // Local/dev without a host context — continue without a signed-in user.
          user = null;
        }
        await reload();
        if (!cancelled) setCurrentUser(user);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const championById = useMemo(
    () => new Map(champions.map((c) => [c.abs_championid, c])),
    [champions],
  );
  const departmentById = useMemo(
    () => new Map(departments.map((d) => [d.abs_departmentid, d])),
    [departments],
  );
  const campaignById = useMemo(
    () => new Map(campaigns.map((c) => [c.abs_campaignid, c])),
    [campaigns],
  );
  const activityById = useMemo(
    () => new Map(activities.map((a) => [a.abs_activityid, a])),
    [activities],
  );

  const pointsByChampion = useMemo(() => {
    const map = new Map<string, number>();
    for (const cl of claims) {
      if (cl.crd49_status !== ClaimStatus.Approved) continue;
      const champId = cl._crd49_champion_value;
      const actId = cl._crd49_activity_value;
      if (!champId) continue;
      const pts = actId ? activityById.get(actId)?.crd49_points ?? 0 : 0;
      map.set(champId, (map.get(champId) ?? 0) + pts);
    }
    return map;
  }, [claims, activityById]);

  const pointsFor = useCallback(
    (championId?: string) => {
      if (!championId) return 0;
      const computed = pointsByChampion.get(championId);
      if (computed != null) return computed;
      return championById.get(championId)?.crd49_totalpoints ?? 0;
    },
    [pointsByChampion, championById],
  );

  const currentChampion = useMemo(() => {
    if (!currentUser?.userPrincipalName) return null;
    const upn = currentUser.userPrincipalName.toLowerCase();
    return (
      champions.find((c) => (c.abs_userid ?? '').toLowerCase() === upn) ??
      null
    );
  }, [champions, currentUser]);

  const isProgramManager = currentChampion?.crd49_role === ChampionRole.ProgramManager;
  const isAppAdmin = useMemo(() => {
    if (!currentUser?.userPrincipalName) return false;
    const upn = currentUser.userPrincipalName.toLowerCase();
    return appAdmins.some((a) => (a.abs_userid ?? '').toLowerCase() === upn);
  }, [appAdmins, currentUser]);
  const isAdmin = isProgramManager || isAppAdmin;

  const value: AppDataValue = {
    loading, error, currentUser, currentChampion, isProgramManager, isAppAdmin, isAdmin,
    champions, departments, campaigns, campaignDepartments, campaignActivities, participations,
    activities, claims, evidence, events, requests, settings, appAdmins,
    championById, departmentById, campaignById, activityById,
    pointsByChampion, pointsFor, reload,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData(): AppDataValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used within AppDataProvider');
  return ctx;
}
