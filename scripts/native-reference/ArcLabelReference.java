import dk.aau.cs.io.*;
import java.io.File;
import java.util.*;
import javax.xml.parsers.DocumentBuilderFactory;
import net.tapaal.gui.petrinet.Template;
import pipe.gui.petrinet.graphicElements.Arc;
import org.w3c.dom.*;

/** Released loader/writer label offsets only; no claim about Swing font layout or simulation. */
public class ArcLabelReference {
  static Map<String,String> observed(LoadedModel model) {
    Map<String,String> result = new TreeMap<>();
    for (Template t : model.templates()) for (Arc a : t.guiModel().getArcs())
      result.put(t.model().name()+"/"+a.getSource().getName()+"/"+a.getTarget().getName(), a.getNameOffsetX()+","+a.getNameOffsetY());
    return result;
  }
  public static void main(String[] args) throws Exception {
    try {
    int count=0;
    for (String path : args) {
      LoadedModel model=new TapnXmlLoader().load(new File(path));
      Map<String,String> actual=observed(model);
      Document xml=DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new File(path));
      NodeList nets=xml.getElementsByTagName("net");
      for(int i=0;i<nets.getLength();i++) {
        Element net=(Element)nets.item(i); NodeList arcs=net.getElementsByTagName("arc");
        Map<String,String> names=new HashMap<>();
        for(String tag:new String[]{"place","transition"}) {
          NodeList nodes=net.getElementsByTagName(tag);
          for(int k=0;k<nodes.getLength();k++) { Element n=(Element)nodes.item(k); names.put(n.getAttribute("id"),n.getAttribute("name")); }
        }
        for(int j=0;j<arcs.getLength();j++) {
          Element arc=(Element)arcs.item(j);
          String x=arc.getAttribute("nameOffsetX"), y=arc.getAttribute("nameOffsetY");
          String expected=x.isEmpty() || y.isEmpty()?"0,0":((int)Double.parseDouble(x))+","+((int)Double.parseDouble(y));
          String key=net.getAttribute("id")+"/"+names.get(arc.getAttribute("source"))+"/"+names.get(arc.getAttribute("target"));
          if(!expected.equals(actual.get(key))) throw new AssertionError(key+" expected "+expected+" got "+actual.get(key));
          count++;
        }
      }
      File saved=File.createTempFile("arc-label-native-", ".tapn");
      try {
        new TimedArcPetriNetNetworkWriter(model.network(),model.templates(),model.queries(),model.network().constants(),model.getLens()).savePNML(saved);
        if(!actual.equals(observed(new TapnXmlLoader().load(saved)))) throw new AssertionError("native resave offsets");
      } finally { saved.delete(); }
    }
    System.out.println("PASS released native label offsets: "+count+" arcs and writer/reopen");
    System.exit(0);
    } catch (Throwable error) { error.printStackTrace(); System.exit(1); }
  }
}
