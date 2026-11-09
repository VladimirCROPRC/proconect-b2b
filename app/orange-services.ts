// Source: FITT138910.xlsx, Services!A4:F10. Only the seven main service packages.
// Supplementary services and example ticket quantities are not package defaults.
export const orangeServicePackages = [
  {
    "code": "SP1 FO",
    "label": "Reparații în locație (ODF / patch)",
    "itemNumber": 3,
    "sourceRow": 4,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services On-site repairs only (ODF, patch); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to 7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  },
  {
    "code": "SP2 FOA",
    "label": "Aerian, fără cablu nou",
    "itemNumber": 4,
    "sourceRow": 5,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services Aerial repairs (no new cable required); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  },
  {
    "code": "SP3 FOA",
    "label": "Aerian, cablu nou sub 200 m",
    "itemNumber": 5,
    "sourceRow": 6,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services Aerial repairs (<200m new cable required); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to 7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  },
  {
    "code": "CR4 FOA",
    "label": "Aerian, cablu nou peste 200 m",
    "itemNumber": 6,
    "sourceRow": 7,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services Aerial, Capital repairs (>200m new cable required); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to 7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  },
  {
    "code": "SP5 FOU",
    "label": "Subteran, cablu până la 100 m",
    "itemNumber": 7,
    "sourceRow": 8,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services Underground repairs (up to max 100m cable required); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to 7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  },
  {
    "code": "CR6 FOU",
    "label": "Subteran, cablu nou 100–300 m",
    "itemNumber": 8,
    "sourceRow": 9,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services Underground, Capital repairs (100m to 300m new cable required); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to 7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  },
  {
    "code": "CR7 FOU",
    "label": "Subteran, cablu nou peste 300 m",
    "itemNumber": 9,
    "sourceRow": 10,
    "name": "Adv. Corrective Maint.(FO)",
    "unit": "intervention",
    "description": "Complete services Underground, Capital repairs (>300m cable required); all services included, except those considered as Specific Works (listed under); The Specific Works items (10-23) will be used in the BoQ on top of Service Package (1-7) if required.\nGeneral requirements applicable to all Service Packages (SP 1 to 7), depending to the infrastructure caracteristics (on site intervention, aerial or underground): fault identification (including required digging), cable installation and preparation, all fibers splicing, closure box - closing, sealing, installation-, handhole installation (including handhole required digging), transport, tests, measurements intervention report, material BoQ, inventory database updates. The other Specific Works will be used in the BoQ seprately if necessary. Only final remediation will be considered for Service Package ticket validation."
  }
] as const;
