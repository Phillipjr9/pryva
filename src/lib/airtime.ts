export type AirtimeProvider = "mtn" | "airtel" | "glo" | "9mobile";

export interface DataPlan {
  id: string;
  provider: AirtimeProvider;
  name: string;
  size: string;
  duration: string;
  price: number;
}

export const dataPlans: DataPlan[] = [
  // MTN
  { id: "mtn-500mb", provider: "mtn", name: "MTN 500MB", size: "500MB", duration: "30 days", price: 500 },
  { id: "mtn-1gb", provider: "mtn", name: "MTN 1GB", size: "1GB", duration: "30 days", price: 1000 },
  { id: "mtn-2gb", provider: "mtn", name: "MTN 2GB", size: "2GB", duration: "30 days", price: 2000 },
  { id: "mtn-5gb", provider: "mtn", name: "MTN 5GB", size: "5GB", duration: "30 days", price: 4500 },
  { id: "mtn-10gb", provider: "mtn", name: "MTN 10GB", size: "10GB", duration: "30 days", price: 8000 },
  
  // Airtel
  { id: "airtel-500mb", provider: "airtel", name: "Airtel 500MB", size: "500MB", duration: "30 days", price: 500 },
  { id: "airtel-1gb", provider: "airtel", name: "Airtel 1GB", size: "1GB", duration: "30 days", price: 1000 },
  { id: "airtel-2gb", provider: "airtel", name: "Airtel 2GB", size: "2GB", duration: "30 days", price: 2000 },
  { id: "airtel-5gb", provider: "airtel", name: "Airtel 5GB", size: "5GB", duration: "30 days", price: 4500 },
  
  // Glo
  { id: "glo-1gb", provider: "glo", name: "Glo 1GB", size: "1GB", duration: "30 days", price: 1000 },
  { id: "glo-2gb", provider: "glo", name: "Glo 2GB", size: "2GB", duration: "30 days", price: 2000 },
  { id: "glo-5gb", provider: "glo", name: "Glo 5GB", size: "5GB", duration: "30 days", price: 4500 },
  
  // 9mobile
  { id: "9mobile-1gb", provider: "9mobile", name: "9mobile 1GB", size: "1GB", duration: "30 days", price: 1000 },
  { id: "9mobile-2gb", provider: "9mobile", name: "9mobile 2GB", size: "2GB", duration: "30 days", price: 2000 },
];

export function getDataPlansByProvider(provider: AirtimeProvider): DataPlan[] {
  return dataPlans.filter((plan) => plan.provider === provider);
}

export function findDataPlan(id: string): DataPlan | undefined {
  return dataPlans.find((plan) => plan.id === id);
}
