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
      GeminiGateway gateway=delegate;
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
