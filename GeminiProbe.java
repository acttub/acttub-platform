package com.acttub.actingapi.integration.observation;
import java.nio.file.Path;
import java.util.UUID;
import com.google.genai.Client;
import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.platform.observability.*;
public class GeminiProbe {
  static void error(Throwable e) {
    for(Throwable t=e;t!=null;t=t.getCause()) {
      String m=String.valueOf(t.getMessage()).replaceAll("https?://[^\\s\"]+", "[URL]").replaceAll("AIza[\\w-]+|sk-[\\w-]+", "[SECRET]");
      System.out.println("PROBE_ERROR="+t.getClass().getSimpleName()+": "+m.substring(0,Math.min(m.length(),1800)));
    }
  }
  public static void main(String[] args) throws Exception {
    String model=System.getenv().getOrDefault("GEMINI_MODEL", "gemini-2.5-flash");
    System.out.println("PROBE_MODEL="+model);
    try(Client c=Client.builder().apiKey(System.getenv("GEMINI_API_KEY")).build()) {
      var delegate=new GoogleGenAiGateway(c);
      GeminiGateway gateway=new GeminiGateway() {
        public GeminiFile upload(Path path,String mime) {
          try(var input=java.nio.file.Files.newInputStream(path)) {
            var f=c.files.upload(input,java.nio.file.Files.size(path),com.google.genai.types.UploadFileConfig.builder().mimeType(mime).build());
            return new GeminiFile(f.name().orElseThrow(),f.uri().orElse(null),f.mimeType().orElse(mime),f.state().map(Object::toString).orElse("PROCESSING"));
          } catch(java.io.IOException e) {throw new java.io.UncheckedIOException(e);}
        }
        public GeminiFile get(String n){return delegate.get(n);}
        public void delete(String n){delegate.delete(n);}
        public String generate(String m,com.google.genai.types.Content v,com.google.genai.types.GenerateContentConfig q){return delegate.generate(m,v,q);}
        public com.google.genai.types.GenerateContentResponse generateResponse(String m,com.google.genai.types.Content v,com.google.genai.types.GenerateContentConfig q){return delegate.generateResponse(m,v,q);}
      };
      try {
        new GeminiTranscriber(new com.acttub.actingapi.integration.media.AudioExtractor(),gateway,
          (e,k,x)->error(e),new LlmTelemetry(){public void record(LlmCall c){} public void score(LlmScore s){}}).analyze(Path.of(args[0]),null,null);
        System.out.println("PROBE_TRANSCRIPTION_SUCCESS");
      } catch(Throwable e) {error(e);}
      var a=new GeminiVideoRecordAnalyzer(gateway,new VideoRecordChunks(),model,
        (e,k,x)->error(e),new LlmTelemetry(){public void record(LlmCall c){} public void score(LlmScore s){}});
      var r=a.analyze(Path.of(args[0]),new ActorMaterial("","","","그 외","",4000),UUID.randomUUID(),null,null);
      System.out.println("PROBE_SUCCESS_SEGMENTS="+r.path("segments").size());
    } catch(Throwable e) {error(e);System.exit(1);}
  }
}
