import dk.aau.cs.io.LoadedModel;
import dk.aau.cs.io.TapnXmlLoader;
import dk.aau.cs.model.tapn.*;
import dk.aau.cs.io.TimedArcPetriNetNetworkWriter;
import java.io.File;
import net.tapaal.gui.petrinet.Template;

// Headless native file IO observation for timed TAPN files (see design/TIMED-UI-VALIDATION.md).
// Loads each file with the released TapnXmlLoader and prints what the native model holds:
// component activity, marking with token ages, invariants, urgency, interval/weight of every arc
// and transport pairs. With RESAVE_DIR set, each loaded model is also written back through the
// released TimedArcPetriNetNetworkWriter as <name>.native.tapn. No frame or Animator is created,
// but loading transport arcs initialises Swing classes, so run under a (virtual) display.
//
//   javac -cp "$TAPAAL_LIB/*" -d OUT TimedFileReference.java
//   xvfb-run -a java -cp "OUT:$TAPAAL_LIB/*" TimedFileReference file.tapn...
public class TimedFileReference {
  public static void main(String[] args) throws Exception {
    for (String path : args) {
      System.out.println("FILE " + new File(path).getName());
      LoadedModel model = new TapnXmlLoader().load(new File(path));
      String resave = System.getenv("RESAVE_DIR");
      if (resave != null)
        new TimedArcPetriNetNetworkWriter(model.network(), model.templates(), model.queries(),
                model.network().constants(), model.getLens())
            .savePNML(new File(resave, new File(path).getName().replace(".tapn", ".native.tapn")));
      for (String message : model.getMessages()) System.out.println("  MESSAGE " + message);
      for (Template template : model.templates()) {
        TimedArcPetriNet net = template.model();
        System.out.println("  COMPONENT " + net.name() + " active=" + template.isActive());
        for (TimedPlace place : net.places()) {
          StringBuilder ages = new StringBuilder();
          for (TimedToken token : place.tokens())
            ages.append(ages.length() == 0 ? "" : ",").append(token.age().toPlainString());
          System.out.println("    PLACE " + place.name() + " tokens=" + place.numberOfTokens()
              + " ages=[" + ages + "] invariant=" + place.invariant());
        }
        for (TimedTransition transition : net.transitions())
          System.out.println("    TRANSITION " + transition.name() + " urgent=" + transition.isUrgent());
        for (TimedInputArc arc : net.inputArcs())
          System.out.println("    INPUT " + arc.source().name() + "->" + arc.destination().name()
              + " interval=" + arc.interval() + " weight=" + arc.getWeight().value());
        for (TimedOutputArc arc : net.outputArcs())
          System.out.println("    OUTPUT " + arc.source().name() + "->" + arc.destination().name()
              + " weight=" + arc.getWeight().value());
        for (TimedInhibitorArc arc : net.inhibitorArcs())
          System.out.println("    INHIBITOR " + arc.source().name() + "->" + arc.destination().name()
              + " weight=" + arc.getWeight().value());
        for (TransportArc arc : net.transportArcs())
          System.out.println("    TRANSPORT " + arc.source().name() + "->" + arc.transition().name()
              + "->" + arc.destination().name() + " interval=" + arc.interval()
              + " weight=" + arc.getWeight().value());
      }
    }
    // Loading touches Swing classes for transport arcs; stop their threads explicitly.
    System.exit(0);
  }
}
