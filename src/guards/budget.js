// Sonsuz və ya həddindən çox API çağırışının qarşısını alır.
// Hər model çağırışından əvvəl spend() çağırılır. Limit dolubsa xəta atılır,
// sistem təhlükəsiz dayanır və saxta uğur bildirmir.

export class BudgetExceededError extends Error {
  constructor(message) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class CallBudget {
  constructor(max) {
    this.max = max;
    this.used = 0;
    this.exceeded = false;
  }

  spend() {
    if (this.used >= this.max) {
      this.exceeded = true;
      throw new BudgetExceededError("model çağırış limiti dolub (" + this.max + ")");
    }
    this.used++;
  }
}
