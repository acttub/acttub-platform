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
      for(var frame:t.getStackTrace()) if(frame.getClassName().startsWith("com.acttub")) System.out.println("PROBE_LOCATION="+frame.getClassName()+"."+frame.getMethodName()+":"+frame.getLineNumber());
      System.out.println("PROBE_ERROR="+t.getClass().getSimpleName()+": "+m.substring(0,Math.min(m.length(),1800)));
    }
  }
  public static void main(String[] args) throws Exception {
    String model=System.getenv().getOrDefault("GEMINI_MODEL", "gemini-2.5-flash");
    System.out.println("PROBE_MODEL="+model);
    try(Client c=Client.builder().apiKey(System.getenv("GEMINI_API_KEY")).build()) {
      var delegate=new GoogleGenAiGateway(c);
      var media=new java.util.HashMap<String,byte[]>();
      GeminiGateway gateway=new GeminiGateway() {
        public GeminiFile upload(Path path,String mime) {
          try {String key="memory:"+System.nanoTime();media.put(key,java.nio.file.Files.readAllBytes(path));return new GeminiFile(key,key,mime,"ACTIVE");}
          catch(java.io.IOException e){throw new java.io.UncheckedIOException(e);}
        }
        public GeminiFile get(String n){throw new IllegalStateException("inline input does not use Files API");}
        public void delete(String n){media.remove(n);}
        public String generate(String m,com.google.genai.types.Content v,com.google.genai.types.GenerateContentConfig q){return generateResponse(m,v,q).text();}
        public com.google.genai.types.GenerateContentResponse generateResponse(String m,com.google.genai.types.Content v,com.google.genai.types.GenerateContentConfig q){
          var parts=v.parts().orElseThrow().stream().map(part->{
            if(part.fileData().isEmpty())return part;
            var data=part.fileData().orElseThrow();
            return com.google.genai.types.Part.fromBytes(media.get(data.fileUri().orElseThrow()),data.mimeType().orElseThrow()).toBuilder().videoMetadata(part.videoMetadata().orElse(null)).build();
          }).toList();
          var r=delegate.generateResponse(m,v.toBuilder().parts(parts).build(),q);
          if(m.contains("transcribe")) {
            System.out.println("PROBE_STT_CANDIDATES="+r.candidates().map(java.util.List::size).orElse(-1));
            for(var c:r.candidates().orElse(java.util.List.of())) {
              System.out.println("PROBE_STT_CONTENT="+c.content().isPresent());
              if(c.content().isPresent()) for(var part:c.content().get().parts().orElse(java.util.List.of())) System.out.println("PROBE_STT_PART=text:"+part.text().isPresent()+",annotations:"+part.audioTranscription().isPresent());
            }
          }
          return r;
        }
      };
      SpeechAnalysis speech=null;
      try {
        speech=new GeminiTranscriber(new com.acttub.actingapi.integration.media.AudioExtractor(),gateway,
          (e,k,x)->error(e),new LlmTelemetry(){public void record(LlmCall c){} public void score(LlmScore s){}}).analyze(Path.of(args[0]),null,null);
        System.out.println("PROBE_TRANSCRIPTION_SUCCESS");
      } catch(Throwable e) {error(e);}
      var a=new GeminiVideoRecordAnalyzer(gateway,new VideoRecordChunks(),model,
        (e,k,x)->error(e),new LlmTelemetry(){public void record(LlmCall c){} public void score(LlmScore s){}});
      var r=a.analyze(Path.of(args[0]),new ActorMaterial("","","","그 외","",4000),UUID.randomUUID(),null,speech);
      System.out.println("PROBE_SUCCESS_SEGMENTS="+r.path("segments").size());
    } catch(Throwable e) {error(e);System.exit(1);}
  }
}
