// Bütün AI adapterlərinin ümumi şablonu.
// Yeni model (məsələn Kimi) əlavə etmək üçün bu sinifdən yeni adapter yaz,
// sonra src/adapters/registry.js içində bir sətirlə qeydiyyata sal.
//
//   id          : qısa ad ("gpt", "kimi"...). Lider modelin planında "owner" kimi görünür.
//   description : lider modelə nə üçün yaxşı olduğunu deyən qısa ingiliscə cümlə.
//   webSearch   : true isə canlı axtarış edə bilir.
//
// run(task, ctx) mütləq { text, web } qaytarmalıdır:
//   task = { id, instruction, prompt, webSearch }
//   ctx  = { budget, timeoutMs }   (hər API çağırışından əvvəl ctx.budget.spend() çağır,
//                                   sorğunu src/guards/http.js içindəki httpRequest ilə göndər)
//   web  = true (canlı axtarışla), false (axtarış alınmadı), null (axtarış mövzusu deyil)

export class BaseAdapter {
  constructor({ id, description = "", webSearch = false }) {
    this.id = id;
    this.description = description;
    this.webSearch = webSearch;
  }

  async run() {
    throw new Error(this.id + " adapteri üçün run() yazılmayıb");
  }
}
