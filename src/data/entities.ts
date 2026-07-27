/**
 * Data-access facade over the generated Power Apps SDK services. Screens/hooks import
 * from here so the generated file names stay in one place. Also defines the OData
 * entity-set paths used for `@odata.bind` lookups and small typed create inputs.
 */
import { Abs_championsService } from '../generated/services/Abs_championsService';
import { Abs_departmentsService } from '../generated/services/Abs_departmentsService';
import { Abs_campaignsService } from '../generated/services/Abs_campaignsService';
import { Abs_campaigndepartmentsService } from '../generated/services/Abs_campaigndepartmentsService';
import { Abs_campaignactivitiesService } from '../generated/services/Abs_campaignactivitiesService';
import { Abs_campaignparticipationsService } from '../generated/services/Abs_campaignparticipationsService';
import { Abs_activitiesService } from '../generated/services/Abs_activitiesService';
import { Abs_activityclaimsService } from '../generated/services/Abs_activityclaimsService';
import { Abs_claimevidencesService } from '../generated/services/Abs_claimevidencesService';
import { Abs_eventsService } from '../generated/services/Abs_eventsService';
import { Abs_requestsService } from '../generated/services/Abs_requestsService';
import { Abs_programsettingsesService } from '../generated/services/Abs_programsettingsesService';
import { Abs_appadminsService } from '../generated/services/Abs_appadminsService';

export const ChampionsSvc = Abs_championsService;
export const DepartmentsSvc = Abs_departmentsService;
export const CampaignsSvc = Abs_campaignsService;
export const CampaignDepartmentsSvc = Abs_campaigndepartmentsService;
export const CampaignActivitiesSvc = Abs_campaignactivitiesService;
export const CampaignParticipationsSvc = Abs_campaignparticipationsService;
export const ActivitiesSvc = Abs_activitiesService;
export const ActivityClaimsSvc = Abs_activityclaimsService;
export const ClaimEvidencesSvc = Abs_claimevidencesService;
export const EventsSvc = Abs_eventsService;
export const RequestsSvc = Abs_requestsService;
export const ProgramSettingsSvc = Abs_programsettingsesService;
export const AppAdminsSvc = Abs_appadminsService;

export type { Abs_champions } from '../generated/models/Abs_championsModel';
export type { Abs_departments } from '../generated/models/Abs_departmentsModel';
export type { Abs_campaigns } from '../generated/models/Abs_campaignsModel';
export type { Abs_campaigndepartments } from '../generated/models/Abs_campaigndepartmentsModel';
export type { Abs_campaignactivities } from '../generated/models/Abs_campaignactivitiesModel';
export type { Abs_campaignparticipations } from '../generated/models/Abs_campaignparticipationsModel';
export type { Abs_activities } from '../generated/models/Abs_activitiesModel';
export type { Abs_activityclaims } from '../generated/models/Abs_activityclaimsModel';
export type { Abs_claimevidences } from '../generated/models/Abs_claimevidencesModel';
export type { Abs_events } from '../generated/models/Abs_eventsModel';
export type { Abs_requests } from '../generated/models/Abs_requestsModel';
export type { Abs_programsettingses } from '../generated/models/Abs_programsettingsesModel';
export type { Abs_appadmins } from '../generated/models/Abs_appadminsModel';

/** OData entity-set paths for `@odata.bind`. */
export const EntitySet = {
  champion: 'abs_champions',
  department: 'abs_departments',
  campaign: 'abs_campaigns',
  activity: 'abs_activities',
  activityclaim: 'abs_activityclaims',
} as const;

/** Build an `@odata.bind` reference, e.g. bind('champion', id) => "/abs_champions(<id>)". */
export function bind(entity: keyof typeof EntitySet, id: string): string {
  return `/${EntitySet[entity]}(${id})`;
}
