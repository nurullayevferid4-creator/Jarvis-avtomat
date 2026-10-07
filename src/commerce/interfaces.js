// Dropshipping / e-commerce İNTERFEYSLƏRİ. Burada REAL təchizatçı, ödəniş və ya çatdırılma inteqrasiyası YOXDUR.
// Yalnız müqavilələr (hansı metodlar olmalıdır, hansı əməliyyatlar insan təsdiqi tələb edir) və "qoşulmayıb" tətbiqləri var.
// Qoşulmamış provider hər çağırışda AppError("VALIDATION_ERROR") atır: saxta nəticə, saxta uğur yoxdur.
//
// Müqavilələr (JSDoc):
//
// SupplierProvider
//   searchProducts({ query, limit }) -> [{ id, title, cost, currency, stock }]   (oxuma)
//   getProduct(id)                   -> { id, title, cost, currency, stock, shipping }   (oxuma)
//   checkStock(id)                   -> { id, available: number }   (oxuma)
//   placeOrder({ productId, qty, ship_to }) -> { order_id }   (YALNIZ insan təsdiqi ilə: pul xərcləmək)
//
// PaymentProvider
//   getPaymentStatus(paymentId)      -> { id, status, amount, currency }   (oxuma)
//   createPaymentRequest({ amount, currency, reference }) -> { id, url }   (YALNIZ insan təsdiqi ilə)
//   refund({ paymentId, amount })    -> { id, status }   (YALNIZ insan təsdiqi ilə)
//
// FulfillmentProvider
//   getTracking(shipmentId)          -> { id, status, events }   (oxuma)
//   estimateShipping({ to, weight }) -> { price, currency, days }   (oxuma)
//   createShipment({ orderId, to })  -> { id }   (YALNIZ insan təsdiqi ilə)
//   cancelShipment(shipmentId)       -> { id, status }   (YALNIZ insan təsdiqi ilə)

import { AppError } from "../errors.js";

export const PROVIDER_CONTRACTS = {
  SupplierProvider: {
    read: ["searchProducts", "getProduct", "checkStock"],
    human_approval_only: ["placeOrder"],
  },
  PaymentProvider: {
    read: ["getPaymentStatus"],
    human_approval_only: ["createPaymentRequest", "refund"],
  },
  FulfillmentProvider: {
    read: ["getTracking", "estimateShipping"],
    human_approval_only: ["createShipment", "cancelShipment"],
  },
};

function notConfiguredClass(name, label) {
  const contract = PROVIDER_CONTRACTS[name];
  const methods = [...contract.read, ...contract.human_approval_only];
  const C = class {
    constructor() {
      this.configured = false;
      this.providerName = name;
    }
  };
  Object.defineProperty(C, "name", { value: "NotConfigured" + name });
  for (const m of methods) {
    C.prototype[m] = async function notConfigured() {
      throw new AppError("VALIDATION_ERROR", label + " provayderi qoşulmayıb (" + m + "): real inteqrasiya yoxdur");
    };
  }
  return C;
}

export const NotConfiguredSupplier = notConfiguredClass("SupplierProvider", "Təchizatçı");
export const NotConfiguredPayment = notConfiguredClass("PaymentProvider", "Ödəniş");
export const NotConfiguredFulfillment = notConfiguredClass("FulfillmentProvider", "Çatdırılma");

// Verilmiş obyekt müqavilənin bütün metodlarını təmin edirmi? Qaytarır: çatışan metodların siyahısı.
export function missingMethods(provider, contractName) {
  const c = PROVIDER_CONTRACTS[contractName];
  if (!c) throw new AppError("VALIDATION_ERROR", "Naməlum müqavilə: " + contractName);
  return [...c.read, ...c.human_approval_only].filter((m) => !provider || typeof provider[m] !== "function");
}

export function createNotConfiguredProviders() {
  return { supplier: new NotConfiguredSupplier(), payment: new NotConfiguredPayment(), fulfillment: new NotConfiguredFulfillment() };
}
