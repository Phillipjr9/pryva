export function getOrderProgressMessage(status: string) {
  if (status === "review") {
    return "This order is under review. Please keep the tab open while we check the provider update.";
  }

  return "Delivery has not been confirmed. Please don't place this order again; contact support with your reference if you need help.";
}
