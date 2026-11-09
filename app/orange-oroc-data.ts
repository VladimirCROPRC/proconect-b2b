import { orangeServicePackages } from "./orange-services";
import { dayStart } from "./technician-report";

export type OrangeTicket = {
  id: string;
  ticketNumber: string;
  workDate: string;
  servicePackageCode: string;
  createdAt: number;
  updatedAt: number;
};

export function validateOrangeTicket(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.ticketNumber !== "string" || typeof input.workDate !== "string" || typeof input.servicePackageCode !== "string") return null;
  const ticketNumber = input.ticketNumber.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(ticketNumber) || dayStart(input.workDate) === null) return null;
  const servicePackage = orangeServicePackages.find(item => item.code === input.servicePackageCode);
  if (!servicePackage) return null;
  return { ticketNumber, workDate: input.workDate, servicePackageCode: servicePackage.code };
}
