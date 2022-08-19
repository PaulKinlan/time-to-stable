class StripStream extends TransformStream {
    constructor() {
  
      let parsedFirstChunk: boolean = false;
      super({
        transform(chunk, controller) {
          if (parsedFirstChunk == false) {
            // 41,  93, 125,  39, 10 == ")]}'\n"
            chunk[0] = 0;
            chunk[1] = 0;
            chunk[2] = 0;
            chunk[3] = 0;
  
            controller.enqueue(chunk);
            parsedFirstChunk = true;
          }
          else {
            controller.enqueue(chunk);
          }
        }
      })
    }
  }